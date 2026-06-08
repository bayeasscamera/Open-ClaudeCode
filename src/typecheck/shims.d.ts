declare module 'bun:bundle' {
  export function feature(flag: string): boolean
}

declare namespace Bun {
  function stringWidth(
    input: string,
    options?: { ambiguousIsNarrow?: boolean },
  ): number
}

declare module 'emoji-regex' {
  export default function emojiRegex(): RegExp
}

declare module 'get-east-asian-width' {
  export function eastAsianWidth(
    codePoint: number,
    options?: { ambiguousAsWide?: boolean },
  ): number
}

declare module 'strip-ansi' {
  export default function stripAnsi(input: string): string
}
