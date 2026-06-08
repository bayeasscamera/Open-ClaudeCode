import { joinPromptValues, canBatchWith } from './print';
import assert from 'node:assert';

console.log('🚀 Starting tests for src/cli/print.ts...\n');

function testJoinPromptValues() {
    console.log('Testing joinPromptValues...');

    // Case 1: Normal values
    assert.strictEqual(joinPromptValues(['Hello', 'World']), 'Hello World');

    // Case 2: Mixed types (numbers/strings)
    assert.strictEqual(joinPromptValues(['Value: ', 123]), 'Value: 123');

    // Case 3: Empty array
    assert.strictEqual(joinPromptValues([]), '');

    // Case 4: Single value
    assert.strictEqual(joinPromptValues(['OnlyOne']), 'OnlyOne');

    console.log('✅ joinPromptValues passed!');
}

function testCanBatchWith() {
    console.log('Testing canBatchWith...');

    const msg1 = { role: 'user', content: 'Hello' } as any;
    const msg2 = { role: 'user', content: 'How are you?' } as any;
    const msg3 = { role: 'assistant', content: 'I am fine' } as any;

    // Same role should be batchable
    assert.strictEqual(canBatchWith(msg1, msg2), true);

    // Different roles should NOT be batchable
    assert.strictEqual(canBatchWith(msg1, msg3), false);

    console.log('✅ canBatchWith passed!');
}

try {
    testJoinPromptValues();
    testCanBatchWith();
    console.log('\n🎉 All tests passed successfully!');
} catch (error) {
    console.error('\n❌ Test failed:');
    console.error(error);
    process.exit(1);
}
