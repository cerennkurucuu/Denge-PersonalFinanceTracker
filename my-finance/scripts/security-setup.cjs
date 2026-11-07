const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const projectRoot=path.join(__dirname,'..');
const envPath=path.join(projectRoot,'.env');

if(!fs.existsSync(envPath)){
  console.error('Önce proje kökünde .env dosyanı oluştur ve MySQL/Google ayarlarını ekle.');
  process.exit(1);
}
const contents=fs.readFileSync(envPath,'utf8');
const existing=contents.match(/^\s*MFA_ENCRYPTION_KEY\s*=\s*(.*?)\s*$/m);
if(existing){
  if(!/^[a-f\d]{64}$/i.test(existing[1].replace(/^(['"])(.*)\1$/,'$2'))){
    console.error('Mevcut MFA_ENCRYPTION_KEY biçimi geçersiz; geçerli anahtarı değiştirmeden önce yedekle.');
    process.exit(1);
  }
  console.log('MFA şifreleme anahtarı zaten yapılandırılmış.');
  process.exit(0);
}
const key=crypto.randomBytes(32).toString('hex');
const separator=contents.endsWith('\n')?'':'\n';
fs.appendFileSync(envPath,`${separator}\n# Denge Authenticator secret encryption key. Keep private and back it up securely.\nMFA_ENCRYPTION_KEY=${key}\n`,{mode:0o600});
try{fs.chmodSync(envPath,0o600);}catch{/* Windows ACLs are inherited from the project folder. */}
console.log('Benzersiz MFA şifreleme anahtarı gizli .env dosyasına eklendi. Anahtar ekrana yazdırılmadı.');
