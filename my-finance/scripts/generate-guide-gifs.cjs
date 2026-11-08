const fs = require('node:fs');
const path = require('node:path');

const output = path.resolve(__dirname, '../public/assets/guides');
const width = 320;
const height = 176;
const palette = [
  [255,255,255],[246,248,246],[224,230,226],[23,29,26],
  [105,115,109],[8,134,95],[232,246,239],[180,228,63],
  [242,172,87],[64,168,212],[240,138,119],[196,203,198],
  [32,61,50],[253,253,253],[188,226,209],[80,94,87],
];
const panels = {
  dashboard:[[78,38,229,37],[78,82,145,62],[78,150,229,16]],
  transactions:[[78,40,229,28],[78,77,229,80],[84,83,217,18]],
  plans:[[78,42,229,20],[78,70,229,74],[260,31,46,19]],
  savings:[[78,42,229,22],[78,72,229,58],[80,137,125,28]],
  cashflow:[[78,39,229,20],[78,67,229,47],[78,119,229,37]],
  calendar:[[78,39,229,20],[78,65,229,75],[220,69,64,19]],
  reports:[[78,39,229,31],[78,76,145,74],[230,76,77,74]],
  categories:[[78,40,229,25],[78,73,229,75],[84,78,73,18]],
  settings:[[78,40,229,30],[78,76,229,31],[78,112,229,31]],
};

function u16(number) { return [number & 255, (number >> 8) & 255]; }

function rectangle(pixels, x, y, w, h, color) {
  x = Math.max(0, x | 0); y = Math.max(0, y | 0);
  for (let row = y; row < Math.min(height, y + h); row++) {
    pixels.fill(color, row * width + x, row * width + Math.min(width, x + w));
  }
}

function outline(pixels, x, y, w, h, color) {
  rectangle(pixels,x,y,w,2,color); rectangle(pixels,x,y+h-2,w,2,color);
  rectangle(pixels,x,y,2,h,color); rectangle(pixels,x+w-2,y,2,h,color);
}

function frameFor(page, frame) {
  const pixels = new Uint8Array(width * height);
  rectangle(pixels,0,0,width,height,0); rectangle(pixels,0,0,64,height,1);
  rectangle(pixels,0,0,64,31,12); rectangle(pixels,10,9,20,5,5);
  rectangle(pixels,10,18,36,2,4);
  const selected = {dashboard:0,transactions:1,plans:2,savings:3,cashflow:4,calendar:5,reports:6,categories:7,settings:8}[page];
  for (let row = 0; row < 7; row++) {
    const y = 43 + row * 17;
    if (row === selected) rectangle(pixels,6,y,52,12,6);
    rectangle(pixels,13,y+4,5,4,row === frame ? 7 : 4);
    rectangle(pixels,23,y+4,28,3,row === frame ? 5 : 2);
  }
  rectangle(pixels,75,11,117,4,3); rectangle(pixels,75,19,174,2,4);
  const areas = panels[page];
  for (let index = 0; index < areas.length; index++) {
    const [x,y,w,h] = areas[index]; rectangle(pixels,x,y,w,h,1); outline(pixels,x,y,w,h,2);
    if (index === 0) {
      rectangle(pixels,x+8,y+7,Math.min(75,w-17),3,4);
      rectangle(pixels,x+8,y+15,Math.min(92,w-17),8,frame%3===index?5:3);
    } else if (page === 'reports' || page === 'dashboard') {
      for (let bar = 0; bar < 8; bar++) {
        const bx=x+10+bar*10, base=y+h-9;
        const barHeight=12+((bar*13+frame*8)%Math.max(15,h-18));
        rectangle(pixels,bx,base-barHeight,5,barHeight,bar%2?7:5);
      }
    } else {
      for (let row=0; row<Math.min(3,Math.floor((h-13)/12)); row++) {
        const ry=y+7+row*12;
        rectangle(pixels,x+8,ry,5,5,row===frame%3?5:11);
        rectangle(pixels,x+18,ry+1,Math.max(12,w-57),3,4);
        rectangle(pixels,x+w-33,ry+1,23,3,row===frame%3?5:2);
        rectangle(pixels,x+8,ry+7,w-18,1,2);
      }
    }
  }
  const [x,y,w,h]=areas[frame%areas.length]; outline(pixels,x-2,y-2,w+4,h+4,5);
  const mx=Math.min(width-12,x+Math.max(8,Math.floor(w*(frame+1)/5)));
  const my=Math.min(height-12,y+Math.max(6,Math.floor(h*.48)));
  for(let step=0;step<10;step++) rectangle(pixels,mx+Math.floor(step/2),my+step,1,1,3);
  return pixels;
}

function imageData(pixels) {
  // Frequent clear codes keep the stream at five bits per code and avoid code-width edge cases.
  const codes=[];
  for(let start=0;start<pixels.length;start+=8){
    codes.push(16);
    for(let i=start;i<Math.min(start+8,pixels.length);i++) codes.push(pixels[i]);
  }
  codes.push(17);
  const bytes=[]; let accumulator=0, bitCount=0;
  for(const code of codes){
    accumulator|=code<<bitCount; bitCount+=5;
    while(bitCount>=8){bytes.push(accumulator&255);accumulator>>>=8;bitCount-=8;}
  }
  if(bitCount) bytes.push(accumulator&255);
  const blocks=[];
  for(let i=0;i<bytes.length;i+=255) blocks.push(Math.min(255,bytes.length-i),...bytes.slice(i,i+255));
  return blocks;
}

function makeGif(page) {
  const bytes=[...Buffer.from('GIF89a'),...u16(width),...u16(height),0xf3,0,0];
  for(const color of palette) bytes.push(...color);
  bytes.push(0x21,0xff,0x0b,...Buffer.from('NETSCAPE2.0'),3,1,0,0,0);
  for(let index=0;index<4;index++){
    bytes.push(0x21,0xf9,4,4,...u16(15),0,0,0x2c,0,0,0,0,...u16(width),...u16(height),0,4,...imageData(frameFor(page,index)),0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

fs.mkdirSync(output,{recursive:true});
for(const page of Object.keys(panels)) fs.writeFileSync(path.join(output,`${page}.gif`),makeGif(page));
