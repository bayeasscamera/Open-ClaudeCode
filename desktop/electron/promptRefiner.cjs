const { collectAnthropicStreamText, collectProviderStreamText } = require('./providerAnthropicProtocol.cjs')
const { textFromAnthropicContent } = require('./providerBridgeMessages.cjs')
const { classifyProviderIssue } = require('./providerIssue.cjs')

const DEFAULT_REFINER_MODEL = 'qwen/qwen3.5-122b-a10b'
const MAX_REFINER_TOKENS = 1400

const SYSTEM_PROMPT = [
  'Tu es un expert en prompt engineering pour agents CLI et applications de code.',
  'Réécris le message utilisateur pour le rendre plus clair, plus actionnable, plus structuré et plus utile pour obtenir un meilleur résultat.',
  'Conserve la langue, l’intention, les chemins de fichiers, les URLs, les noms de modèles, les contraintes et les clés déjà présentes sans les modifier.',
  'N’exécute aucune demande. Ne réponds pas au fond de la demande.',
  'Retourne uniquement le prompt amélioré, sans préface, sans explication et sans markdown décoratif.',
].join('\n')

function text(value, max = 20000) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .slice(0, max)
    .trim()
}

function modelNeedle(value) {
  return String(value || '').toLowerCase().replace(/[\s_-]+/g, '')
}

function profileText(profile = {}) {
  return [profile.id, profile.model, profile.label, profile.provider, profile.providerName]
    .filter(Boolean)
    .join(' ')
}

function findRefinerProfile(providerConfigStore, requestedModel = '') {
  const config = providerConfigStore.reload()
  const requested = text(requestedModel, 256)
  if (requested) {
    const exact = providerConfigStore.profileForModel(requested)
    if (exact) return exact
  }
  const preferred = providerConfigStore.profileForModel(DEFAULT_REFINER_MODEL)
  if (preferred) return preferred
  const profiles = Array.isArray(config.profiles) ? config.profiles : []
  return profiles.find(profile => modelNeedle(profileText(profile)).includes('qwen3.5122b'))
    || profiles.find(profile => providerConfigStore.upstreamApi(profile) !== 'gitlab-code-suggestions')
    || null
}

function withoutReasoningControls(body = {}) {
  const {
    thinking,
    chat_template_kwargs: chatTemplateKwargs,
    include_reasoning: includeReasoning,
    reasoning,
    ...rest
  } = body
  void thinking
  void includeReasoning
  void reasoning
  if (!chatTemplateKwargs || typeof chatTemplateKwargs !== 'object' || Array.isArray(chatTemplateKwargs)) return rest
  const { enable_thinking: enableThinking, ...remaining } = chatTemplateKwargs
  void enableThinking
  return Object.keys(remaining).length ? { ...rest, chat_template_kwargs: remaining } : rest
}

function cleanRefinedText(value) {
  let refined = String(value || '').trim()
  refined = refined.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/i, '').trim()
  refined = refined.replace(/^(prompt\s+raffin[ée]|prompt\s+am[ée]lior[ée]|version\s+am[ée]lior[ée])\s*:\s*/i, '').trim()
  return refined
}

function openAiText(parsed = {}) {
  const choice = parsed.choices?.[0] || {}
  const content = choice.message?.content ?? choice.text ?? parsed.output_text ?? ''
  if (Array.isArray(content)) {
    return content.map(item => (typeof item === 'string' ? item : item?.text || '')).filter(Boolean).join('\n')
  }
  return content || ''
}

function anthopicBody(profile, providerConfigStore, prompt) {
  return {
    model: profile.model,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: `Prompt à raffiner:\n\n${prompt}` }],
      },
    ],
    max_tokens: Math.min(providerConfigStore.maxTokens(profile, MAX_REFINER_TOKENS), MAX_REFINER_TOKENS),
    temperature: 0.2,
    stream: false,
    ...withoutReasoningControls(providerConfigStore.extraBody(profile)),
  }
}

function openAiBody(profile, providerConfigStore, prompt) {
  const body = {
    model: profile.model,
    messages: providerConfigStore.withSystemPrefix([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Prompt à raffiner:\n\n${prompt}` },
    ], profile),
    max_tokens: Math.min(providerConfigStore.maxTokens(profile, MAX_REFINER_TOKENS), MAX_REFINER_TOKENS),
    temperature: 0.2,
    stream: false,
    ...withoutReasoningControls(providerConfigStore.extraBody(profile)),
  }
  const caps = providerConfigStore.capabilities?.(profile) || {}
  if (caps.temperature === false) delete body.temperature
  return body
}

function createPromptRefiner({ providerConfigStore, providerClient, refinerModel = DEFAULT_REFINER_MODEL }) {
  function failure(profile, startedAt, patch = {}) {
    const error = patch.error || ''
    return {
      ok: false,
      model: profile?.model || refinerModel,
      provider: profile ? providerConfigStore.providerName(profile) : '',
      latencyMs: Date.now() - startedAt,
      ...patch,
      issue: patch.issue || classifyProviderIssue(error, patch.statusCode),
    }
  }

  async function refine(payload = {}) {
    const prompt = text(payload.prompt)
    const requestedModel = text(payload.model, 256)
    const startedAt = Date.now()
    if (!prompt) return { ok: false, error: 'Prompt vide.' }

    const profile = findRefinerProfile(providerConfigStore, requestedModel)
    if (!profile) {
      const missingModel = requestedModel || refinerModel
      return {
        ok: false,
        model: missingModel,
        error: `Le modèle de raffinage ${missingModel} est introuvable dans les providers OPC.`,
      }
    }
    if (!profile.apiKey && profile.auth !== false && profile.noAuth !== true) {
      return {
        ok: false,
        model: profile.model,
        provider: providerConfigStore.providerName(profile),
        error: `Le provider ${profile.label || profile.model} n’est pas configuré.`,
      }
    }

    const upstreamApi = providerConfigStore.upstreamApi(profile)
    if (upstreamApi === 'gitlab-code-suggestions') {
      return failure(profile, startedAt, {
        error: 'Le raffinage nécessite un provider chat OpenAI-compatible ou Anthropic, pas GitLab Code Suggestions.',
      })
    }

    const requestProfile = {
      ...profile,
      timeoutMs: providerConfigStore.requestTimeout(profile),
      retries: 0,
    }
    const body = upstreamApi === 'anthropic'
      ? anthopicBody(profile, providerConfigStore, prompt)
      : openAiBody(profile, providerConfigStore, prompt)

    return await new Promise(resolve => {
      let settled = false
      let timeout = null
      function finish(value) {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        resolve(value)
      }

      const req = providerClient.request(
        requestProfile,
        body,
        upstream => {
          let raw = ''
          upstream.on('data', chunk => {
            raw += String(chunk)
          })
          upstream.on('error', error => {
            finish(failure(profile, startedAt, { error: error.message }))
          })
          upstream.on('aborted', () => {
            finish(failure(profile, startedAt, { error: 'Provider response aborted.' }))
          })
          upstream.on('end', () => {
            const latencyMs = Date.now() - startedAt
            if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
              try {
                const parsed = JSON.parse(raw || '{}')
                const error = parsed?.error?.message || parsed?.error || parsed?.message || raw || `HTTP ${upstream.statusCode}`
                finish(failure(profile, startedAt, { statusCode: upstream.statusCode, latencyMs, error }))
              } catch {
                finish(failure(profile, startedAt, { statusCode: upstream.statusCode, latencyMs, error: raw || `HTTP ${upstream.statusCode}` }))
              }
              return
            }
            try {
              const rawText = body.stream
                ? upstreamApi === 'anthropic' ? collectAnthropicStreamText(raw) : collectProviderStreamText(raw)
                : upstreamApi === 'anthropic'
                  ? textFromAnthropicContent(JSON.parse(raw || '{}').content)
                  : openAiText(JSON.parse(raw || '{}'))
              const refined = cleanRefinedText(rawText)
              if (!refined) {
                finish(failure(profile, startedAt, {
                  latencyMs,
                  error: 'Le modèle n’a pas retourné de prompt raffiné.',
                  issue: { code: 'empty_response', label: 'format', detail: 'Réponse vide.' },
                }))
                return
              }
              finish({
                ok: true,
                model: profile.model,
                provider: providerConfigStore.providerName(profile),
                latencyMs,
                text: refined,
              })
            } catch (error) {
              finish(failure(profile, startedAt, {
                latencyMs,
                error: error.message,
                issue: { code: 'invalid_response', label: 'format', detail: 'Réponse JSON invalide.' },
              }))
            }
          })
        },
        error => {
          finish(failure(profile, startedAt, { error: error.message }))
        },
      )

      timeout = setTimeout(() => {
        const seconds = Math.round(requestProfile.timeoutMs / 1000)
        const error = `Prompt refine timeout after ${seconds}s.`
        req.destroy(new Error(error))
        finish(failure(profile, startedAt, { error }))
      }, requestProfile.timeoutMs + 500)
    })
  }

  return { refine }
}

module.exports = {
  DEFAULT_REFINER_MODEL,
  createPromptRefiner,
}
