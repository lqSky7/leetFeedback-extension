// Test script to validate commit message formatting

// Sample problem data for different platforms
const testCases = [
  // LeetCode tests
  {
    platform: 'leetcode',
    problemInfo: {
      title: '6. Zigzag Conversion',
      number: '6',
      difficulty: 'Medium',
      language: 'cpp',
      stats: { runtime: '4 ms', memory: '7.8 MB' }
    },
    expectedMessage: 'Zigzag Conversion - Leetcode [Medium]'
  },
  {
    platform: 'leetcode',
    problemInfo: {
      title: 'Two Sum',
      number: '1',
      difficulty: 'Easy',
      language: 'javascript'
    },
    expectedMessage: 'Two Sum - Leetcode [Easy]'
  },
  {
    platform: 'leetcode',
    problemInfo: {
      title: '42. Trapping Rain Water',
      number: '42',
      difficulty: 'Hard',
      language: 'python'
    },
    expectedMessage: 'Trapping Rain Water - Leetcode [Hard]'
  },
  
  // GeeksForGeeks tests
  {
    platform: 'geeksforgeeks',
    problemInfo: {
      title: "Kadane's Algorithm",
      difficulty: 'Medium',
      language: 'cpp'
    },
    expectedMessage: "Kadane's Algorithm - Geeksforgeeks [Medium]"
  },
  {
    platform: 'geeksforgeeks',
    problemInfo: {
      title: "[GEEKSFORGEEKS] Kadane's Algorithm (Medium)",
      difficulty: 'Medium',
      language: 'cpp'
    },
    expectedMessage: "Kadane's Algorithm - Geeksforgeeks [Medium]"
  },
  
  // TakeUforward tests
  {
    platform: 'takeuforward',
    problemInfo: {
      title: 'Maximum Subarray Sum',
      difficulty: 'Medium',
      language: 'java'
    },
    expectedMessage: 'Maximum Subarray Sum - Takeuforward [Medium]'
  }
];

// Run tests
function runTests() {
  console.log('Running commit message format tests...');
  
  let passedCount = 0;
  const failedTests = [];
  
  testCases.forEach((test, index) => {
    const { platform, problemInfo, expectedMessage } = test;
    
    try {
      const actualMessage = DSAUtils.generateCommitMessage(platform, problemInfo);
      
      if (actualMessage === expectedMessage) {
        console.log(`✅ Test ${index+1} PASSED`);
        passedCount++;
      } else {
        console.log(`❌ Test ${index+1} FAILED`);
        console.log(`   Expected: "${expectedMessage}"`);
        console.log(`   Actual  : "${actualMessage}"`);
        failedTests.push({ index, expected: expectedMessage, actual: actualMessage });
      }
    } catch (error) {
      console.error(`❌ Test ${index+1} ERROR:`, error);
      failedTests.push({ index, error: error.message });
    }
  });
  
  console.log('\nTest Summary:');
  console.log(`${passedCount} of ${testCases.length} tests passed`);
  
  if (failedTests.length > 0) {
    console.log('\nFailed Tests:');
    failedTests.forEach(failure => {
      console.log(`- Test ${failure.index+1} failed`);
      if (failure.error) {
        console.log(`  Error: ${failure.error}`);
      } else {
        console.log(`  Expected: "${failure.expected}"`);
        console.log(`  Actual  : "${failure.actual}"`);
      }
    });
  }
}

// Run the tests when this script is loaded
// Make sure DSAUtils is available
if (typeof DSAUtils !== 'undefined') {
  runTests();
} else {
  console.error('DSAUtils not found. Please load this script after common.js');
}