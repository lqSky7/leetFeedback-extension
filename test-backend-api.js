// Test script for Backend API - Run this in the browser console on a LeetCode page

async function testBackendAPI(authToken) {
  console.log('🧪 [Test] Starting Backend API test...');
  
  if (!authToken) {
    console.error('❌ [Test] Please provide your auth token!');
    console.log('💡 [Test] Usage: testBackendAPI("your-jwt-token-here")');
    console.log('💡 [Test] You can get your token from the extension popup or from your browser storage');
    return;
  }
  
  console.log('✅ [Test] Using provided auth token:', authToken.substring(0, 20) + '...');
  
  try {
    // Step 2: Test with Authorization header (current implementation)
    console.log('🔄 [Test] Step 3: Testing with Authorization Bearer header...');
    
    const testData = {
      "name": "Test Problem",
      "platform": "leetcode",
      "difficulty": 2,
      "solved": {
        "value": true,
        "date": Date.now(),
        "tries": 1
      },
      "ignored": false,
      "parent_topic": "Array",
      "grandparent": "Data Structures",
      "problem_link": "/problems/test-problem"
    };
    
    try {
      const response1 = await fetch('https://traverse-backend-api.azurewebsites.net/api/problems/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(testData)
      });
      
      console.log('📊 [Test] Authorization Bearer response status:', response1.status);
      const responseText1 = await response1.text();
      console.log('📊 [Test] Authorization Bearer response:', responseText1);
      
      if (response1.ok) {
        console.log('✅ [Test] SUCCESS with Authorization Bearer header!');
        return 'bearer';
      }
    } catch (error) {
      console.log('❌ [Test] Authorization Bearer failed:', error.message);
    }
    
    // Step 4: Test with Cookie header
    console.log('🔄 [Test] Step 4: Testing with Cookie header...');
    
    try {
      const response2 = await fetch('https://traverse-backend-api.azurewebsites.net/api/problems/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `token=${authToken}`
        },
        body: JSON.stringify(testData)
      });
      
      console.log('📊 [Test] Cookie response status:', response2.status);
      const responseText2 = await response2.text();
      console.log('📊 [Test] Cookie response:', responseText2);
      
      if (response2.ok) {
        console.log('✅ [Test] SUCCESS with Cookie header!');
        return 'cookie';
      }
    } catch (error) {
      console.log('❌ [Test] Cookie header failed:', error.message);
    }
    
    // Step 5: Test with XMLHttpRequest and Cookie
    console.log('🔄 [Test] Step 5: Testing with XMLHttpRequest and Cookie...');
    
    try {
      const xhrResponse = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'https://traverse-backend-api.azurewebsites.net/api/problems/push');
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Cookie', `token=${authToken}`);
        
        xhr.onload = () => {
          resolve({
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            text: xhr.responseText
          });
        };
        
        xhr.onerror = () => reject(new Error('XHR request failed'));
        
        xhr.send(JSON.stringify(testData));
      });
      
      console.log('📊 [Test] XHR response status:', xhrResponse.status);
      console.log('📊 [Test] XHR response:', xhrResponse.text);
      
      if (xhrResponse.ok) {
        console.log('✅ [Test] SUCCESS with XMLHttpRequest Cookie!');
        return 'xhr-cookie';
      }
    } catch (error) {
      console.log('❌ [Test] XMLHttpRequest failed:', error.message);
    }
    
    // Step 6: Test different token formats
    console.log('🔄 [Test] Step 6: Testing different token formats...');
    
    // Try with 'Bearer ' prefix removed
    const cleanToken = authToken.replace('Bearer ', '');
    try {
      const response3 = await fetch('https://traverse-backend-api.azurewebsites.net/api/problems/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `token=${cleanToken}`
        },
        body: JSON.stringify(testData)
      });
      
      console.log('📊 [Test] Clean token response status:', response3.status);
      const responseText3 = await response3.text();
      console.log('📊 [Test] Clean token response:', responseText3);
      
      if (response3.ok) {
        console.log('✅ [Test] SUCCESS with clean token in Cookie!');
        return 'clean-cookie';
      }
    } catch (error) {
      console.log('❌ [Test] Clean token failed:', error.message);
    }
    
    console.log('❌ [Test] All authentication methods failed!');
    return null;
    
  } catch (error) {
    console.error('💥 [Test] Test script error:', error);
  }
}

// Step 7: Test current problem data formatting
async function testProblemDataFormatting() {
  console.log('🧪 [Test] Testing problem data formatting...');
  
  try {
    // Get current problem URL (simulating LeetCode extractor)
    const url = window.location.href;
    const match = url.match(/\/problems\/([^\/]+)/);
    const currentProblemUrl = match ? match[1] : 'test-problem';
    
    console.log('📍 [Test] Current problem URL:', currentProblemUrl);
    
    // Check if problem data exists in storage
    const storageKey = `problem_data_${currentProblemUrl}`;
    const result = await chrome.storage.local.get([storageKey]);
    const storedData = result[storageKey];
    
    if (!storedData) {
      console.log('⚠️ [Test] No problem data found in storage for:', currentProblemUrl);
      
      // List all problem data keys
      const allStorage = await chrome.storage.local.get(null);
      const problemKeys = Object.keys(allStorage).filter(key => key.startsWith('problem_data_'));
      console.log('📋 [Test] Available problem data keys:', problemKeys);
      return;
    }
    
    console.log('📋 [Test] Raw stored problem data:', storedData);
    
    // Test the formatting function
    const formatProblemData = (storedProblemData) => {
      const {
        name,
        platform = 'leetcode',
        difficulty = 1,
        solved = { value: false, date: 0, tries: 0 },
        ignored = false,
        parent_topic = [],
        problem_link
      } = storedProblemData;

      const topics = Array.isArray(parent_topic) ? parent_topic : [];
      const parentTopic = topics.length > 0 ? topics[0] : 'Unknown Topic';
      const grandparent = topics.length > 1 ? topics[1] : 'General';

      return {
        name: name || 'Unknown Problem',
        platform: platform.toLowerCase(),
        difficulty: Number(difficulty) || 1,
        solved: {
          value: Boolean(solved.value),
          date: Number(solved.date) || 0,
          tries: Number(solved.tries) || 0
        },
        ignored: Boolean(ignored),
        parent_topic: parentTopic,
        grandparent: grandparent,
        problem_link: problem_link || ''
      };
    };
    
    const formattedData = formatProblemData(storedData);
    console.log('📋 [Test] Formatted problem data:', formattedData);
    
  } catch (error) {
    console.error('💥 [Test] Problem data formatting error:', error);
  }
}

// Run both tests
console.log('🚀 [Test] Starting Backend API tests...');
console.log('📝 [Test] Run testBackendAPI() to test authentication');
console.log('📝 [Test] Run testProblemDataFormatting() to test data formatting');

// Auto-run the tests
(async () => {
  await testBackendAPI();
  await testProblemDataFormatting();
})();