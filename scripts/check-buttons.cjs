const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  
  await page.goto('http://localhost:3000/p/05829522-1afc-4075-9325-7fb1fd824724/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  // Check for Yes/No buttons
  const yesButton = await page.$('button:has-text("Yes")');
  const noButton = await page.$('button:has-text("No")');
  const abstainButton = await page.$('button:has-text("Abstain")');
  
  console.log('Yes button exists:', !!yesButton);
  console.log('No button exists:', !!noButton);
  console.log('Abstain button exists:', !!abstainButton);
  
  // Get all button texts on page
  const allButtons = await page.$$eval('button', buttons => buttons.map(b => b.textContent.trim()));
  console.log('All button texts on page:', allButtons);
  
  // Check if we can find the voting section
  const votingSection = await page.$('.flex.gap-2.mb-4');
  if (votingSection) {
    const votingHTML = await votingSection.innerHTML();
    console.log('Voting section HTML:', votingHTML);
  } else {
    console.log('No voting section found');
    
    // Check page title to see if it loaded correctly
    const title = await page.title();
    console.log('Page title:', title);
    
    // Check for any error messages
    const errorMsg = await page.$('.bg-red-100');
    if (errorMsg) {
      const errorText = await errorMsg.textContent();
      console.log('Error message:', errorText);
    }
  }
  
  await browser.close();
})();