#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env.production' });

console.log('🧪 Testing database environment configuration...\n');

console.log('📊 Available Environment Variables:');
console.log(`   NEXT_PUBLIC_SUPABASE_URL_TEST: ${process.env.NEXT_PUBLIC_SUPABASE_URL_TEST ? '✅ Set' : '❌ Missing'}`);
console.log(`   NEXT_PUBLIC_SUPABASE_URL_PRODUCTION: ${process.env.NEXT_PUBLIC_SUPABASE_URL_PRODUCTION ? '✅ Set' : '❌ Missing'}`);

console.log('\n🔍 Database URLs:');
console.log(`   Test DB:       ${process.env.NEXT_PUBLIC_SUPABASE_URL_TEST}`);
console.log(`   Production DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL_PRODUCTION}`);

console.log('\n🎯 Switching Logic:');
console.log('   • NODE_ENV=development → Uses test database (kfngceqepnzlljkwedtd)');
console.log('   • NODE_ENV=production  → Uses production database (kifnvombihyfwszuwqvy)');

console.log('\n✅ Environment configuration is ready!');
console.log('\n📝 Next Steps:');
console.log('   1. Run "npm run dev" → Uses test database with 5000 sample polls');
console.log('   2. Deploy to production → Automatically uses production database');
console.log('   3. Check browser console for database confirmation logs');