// Simple Backend API Test - Run this in browser console

async function testLoginAndPush() {
  console.log('🧪 [Test] Starting login and push test...');
  
  try {
    // Step 1: Login to get the token
    console.log('🔐 [Test] Step 1: Logging in...');
    
    const loginResponse = await fetch('https://leetfeedback-backend.onrender.com/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'admin'
      })
    });
    
    console.log('📊 [Test] Login response status:', loginResponse.status);
    const loginData = await loginResponse.json();
    console.log('📊 [Test] Login response data:', loginData);
    
    if (!loginResponse.ok) {
      console.error('❌ [Test] Login failed!');
      return;
    }
    
    // Extract token from response
    const token = loginData.token || loginData.access_token || loginData.authToken || loginData.jwt;
    if (!token) {
      console.error('❌ [Test] No token found in login response!');
      return;
    }
    
    console.log('✅ [Test] Login successful! Token:', token.substring(0, 30) + '...');
    
    // Step 2: Test push with Cookie header
    console.log('🔄 [Test] Step 2: Testing push with Cookie header...');
    
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
    
    const pushResponse = await fetch('https://leetfeedback-backend.onrender.com/api/problems/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${token}`
      },
      body: JSON.stringify(testData)
    });
    
    console.log('📊 [Test] Push response status:', pushResponse.status);
    const pushResponseText = await pushResponse.text();
    console.log('📊 [Test] Push response:', pushResponseText);
    
    if (pushResponse.ok) {
      console.log('✅ [Test] SUCCESS! Push worked with Cookie header!');
      console.log('🎯 [Test] Working method: Cookie header with token from login');
    } else {
      console.log('❌ [Test] Push failed with Cookie header');
      
      // Step 3: Try with Authorization Bearer header
      console.log('🔄 [Test] Step 3: Testing push with Authorization Bearer header...');
      
      const pushResponse2 = await fetch('https://leetfeedback-backend.onrender.com/api/problems/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(testData)
      });
      
      console.log('📊 [Test] Bearer push response status:', pushResponse2.status);
      const pushResponse2Text = await pushResponse2.text();
      console.log('📊 [Test] Bearer push response:', pushResponse2Text);
      
      if (pushResponse2.ok) {
        console.log('✅ [Test] SUCCESS! Push worked with Authorization Bearer header!');
        console.log('🎯 [Test] Working method: Authorization Bearer header');
      } else {
        console.log('❌ [Test] Both authentication methods failed');
      }
    }
    
  } catch (error) {
    console.error('💥 [Test] Error:', error);
  }
}

// Helper function to test with manual token
async function testPushWithToken(token) {
  console.log('🧪 [Test] Testing push with provided token...');
  
  const testData = {
    "name": "Manual Test Problem",
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
    "problem_link": "/problems/manual-test"
  };
  
  console.log('🔄 [Test] Testing Cookie method...');
  const response1 = await fetch('https://leetfeedback-backend.onrender.com/api/problems/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `token=${token}`
    },
    body: JSON.stringify(testData)
  });
  
  console.log('📊 [Test] Cookie response:', response1.status, await response1.text());
  
  console.log('🔄 [Test] Testing Bearer method...');
  const response2 = await fetch('https://leetfeedback-backend.onrender.com/api/problems/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(testData)
  });
  
  console.log('📊 [Test] Bearer response:', response2.status, await response2.text());
}

console.log('🚀 [Test] Test functions loaded!');
console.log('📝 [Test] Run: testLoginAndPush() - to test full login + push flow');
console.log('📝 [Test] Run: testPushWithToken("your-token") - to test push with existing token');

// Auto-run the login test
testLoginAndPush();