const sharp = require('sharp')
const toIco = require('to-ico')
const fs = require('fs')
const path = require('path')

async function generateIcon() {
  const svgPath = path.join(__dirname, '..', 'resources', 'icon.svg')
  const icoPath = path.join(__dirname, '..', 'resources', 'icon.ico')
  const pngPath = path.join(__dirname, '..', 'resources', 'icon.png')

  const svgBuffer = fs.readFileSync(svgPath)

  // Generate PNG at different sizes for ICO
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngBuffers = []

  for (const size of sizes) {
    const pngBuffer = await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toBuffer()
    pngBuffers.push(pngBuffer)
  }

  // Save 256x256 PNG
  fs.writeFileSync(pngPath, pngBuffers[pngBuffers.length - 1])

  // Generate ICO
  const icoBuffer = await toIco(pngBuffers)
  fs.writeFileSync(icoPath, icoBuffer)

  console.log('Icon generated successfully!')
  console.log('  ICO:', icoPath)
  console.log('  PNG:', pngPath)
}

generateIcon().catch(console.error)
