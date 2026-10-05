import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3000/api/datasets';

async function runTests() {
  console.log("=== API INTEGRATION TESTS ===");
  try {
    // 1. Upload Test
    console.log("1. Testing Upload CSV...");
    
    // Create a mock CSV
    const csvContent = `id,name,age,salary,dropout\n1,Alice,25,50000,0\n2,Bob,30,,0\n3,Charlie,22,30000,1\n4,David,25,50000,0\n`;
    const tempFile = path.join(__dirname, 'test.csv');
    fs.writeFileSync(tempFile, csvContent);
    
    const formData = new FormData();
    const blob = new Blob([csvContent], { type: 'text/csv' });
    formData.append('file', blob, 'test.csv');
    
    const uploadRes = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData
    });
    
    const uploadData = await uploadRes.json();
    if (!uploadData.success) {
      throw new Error("Upload failed: " + uploadData.error);
    }
    
    console.log("Upload Success:", uploadData.dataset.datasetId);
    console.log("Manifest:", JSON.stringify(uploadData.dataset.manifest, null, 2));
    
    if (uploadData.dataset.manifest.recordCount !== 4) throw new Error("Wrong record count");
    
    fs.unlinkSync(tempFile);
    console.log("Upload parsed successfully.");

  } catch (err) {
    console.error("Test failed:", err);
  }
}

runTests();
