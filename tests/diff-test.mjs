import fs from 'fs';
import assert from 'assert';

// Mock browser globals
global.window = {};
global.chrome = {
    storage: {
        sync: {
            get(keys, cb) {
                cb({});
            }
        }
    }
};

// Evaluate the gemini-api.js file in global scope
const fileContent = fs.readFileSync('./utils/gemini-api.js', 'utf8');
eval(fileContent);

const api = new window.GeminiAPI();

function testComputeDiff() {
    console.log("Running testComputeDiff...");

    // Test Case 1: Identical strings
    assert.strictEqual(api.computeDiff("hello", "hello"), "(No changes)");

    // Test Case 2: Empty/null/undefined inputs
    assert.strictEqual(api.computeDiff("", "new line"), "@@ -... +... @@\n+new line");
    assert.strictEqual(api.computeDiff("old line", ""), "@@ -... +... @@\n-old line");

    // Test Case 3: Line additions, deletions, changes
    const oldCode = `function add(a, b) {
    return a + b;
}`;
    const newCode = `function add(a, b) {
    // adding safety check
    if (typeof a !== 'number') return 0;
    return a + b;
}`;
    const diff = api.computeDiff(oldCode, newCode);
    console.log("Generated Diff:\n", diff);
    assert.ok(diff.includes("+    // adding safety check"));
    assert.ok(diff.includes("+    if (typeof a !== 'number') return 0;"));
    assert.ok(diff.includes(" function add(a, b) {"));
    assert.ok(diff.includes(" return a + b;"));

    // Test Case 4: Complete rewrite
    const rewriteOld = "console.log(1);";
    const rewriteNew = "let x = 2;\nconsole.log(x);";
    const diffRewrite = api.computeDiff(rewriteOld, rewriteNew);
    assert.ok(diffRewrite.includes("-console.log(1);"));
    assert.ok(diffRewrite.includes("+let x = 2;"));
    assert.ok(diffRewrite.includes("+console.log(x);"));

    // Test Case 5: Oversized input (safeguard)
    const largeOld = "a\n".repeat(2001);
    const largeNew = "b\n".repeat(2001);
    const diffLarge = api.computeDiff(largeOld, largeNew);
    assert.strictEqual(diffLarge, largeNew); // returns full newCode under fallback

    console.log("testComputeDiff passed successfully!\n");
}

function testBuildAnalysisPrompt() {
    console.log("Running testBuildAnalysisPrompt...");

    const attempts = [
        {
            language: "javascript",
            code: "function main() {\n  return 1;\n}"
        },
        {
            language: "javascript",
            code: "function main() {\n  // edit\n  return 2;\n}"
        }
    ];

    const problemInfo = {
        title: "Test Problem",
        description: "Solve this simple test."
    };

    const prompt = api.buildAnalysisPrompt(attempts, problemInfo);
    console.log("Generated Prompt:\n", prompt);

    assert.ok(prompt.includes("Problem: Test Problem"));
    assert.ok(prompt.includes("Description: Solve this simple test."));
    assert.ok(prompt.includes("### Attempt 1 (Initial Code)"));
    assert.ok(prompt.includes("### Attempt 2 (Diff from Attempt 1)"));
    assert.ok(prompt.includes("Note: Attempt 1 contains the full initial code. Subsequent attempts are presented as diffs"));
    assert.ok(prompt.includes("-  return 1;"));
    assert.ok(prompt.includes("+  // edit"));
    assert.ok(prompt.includes("+  return 2;"));

    console.log("testBuildAnalysisPrompt passed successfully!\n");
}

try {
    testComputeDiff();
    testBuildAnalysisPrompt();
    console.log("All tests passed successfully!");
} catch (e) {
    console.error("Test failed:", e);
    process.exit(1);
}
