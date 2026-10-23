// Dessine l'icône de Ledger (1024 px) : une page de registre, lignes bleues, marge rouge, total souligné deux fois.
// Usage : swift mac/make-icon.swift sortie.png
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"
let size = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

func color(_ hex: UInt32, _ a: CGFloat = 1) -> NSColor {
  NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: a)
}
func rounded(_ r: NSRect, _ radius: CGFloat) -> NSBezierPath { NSBezierPath(roundedRect: r, xRadius: radius, yRadius: radius) }

// Fond : carré arrondi de la grille d'icônes macOS (824 px dans 1024), encre bleue
let body = NSRect(x: 100, y: 100, width: 824, height: 824)
NSGraphicsContext.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = color(0x000000, 0.28); shadow.shadowOffset = NSSize(width: 0, height: -10); shadow.shadowBlurRadius = 24
shadow.set()
color(0x1d3473).setFill()
rounded(body, 185).fill()
NSGraphicsContext.restoreGraphicsState()
NSGradient(starting: color(0x3d63bd), ending: color(0x1b2f68))!.draw(in: rounded(body, 185), angle: -90)

// Page de registre, légèrement inclinée
NSGraphicsContext.saveGraphicsState()
let t = NSAffineTransform()
t.translateX(by: 512, yBy: 500); t.rotate(byDegrees: -4); t.translateX(by: -512, yBy: -500)
t.concat()
let page = NSRect(x: 262, y: 212, width: 500, height: 600)
let pageShadow = NSShadow()
pageShadow.shadowColor = color(0x0a1638, 0.45); pageShadow.shadowOffset = NSSize(width: 0, height: -14); pageShadow.shadowBlurRadius = 30
NSGraphicsContext.saveGraphicsState(); pageShadow.set(); color(0xf5f6f1).setFill(); rounded(page, 26).fill(); NSGraphicsContext.restoreGraphicsState()

// Lignes du registre
let left = page.minX + 36, right = page.maxX - 36
var y = page.maxY - 92
var rows: [CGFloat] = []
while y > page.minY + 120 { rows.append(y); y -= 62 }
for ry in rows {
  let l = NSBezierPath(); l.move(to: NSPoint(x: left, y: ry)); l.line(to: NSPoint(x: right, y: ry))
  l.lineWidth = 4; color(0xbcc9e3).setStroke(); l.stroke()
}
// Marge rouge et colonne des montants
let margin = NSBezierPath(); margin.move(to: NSPoint(x: page.minX + 108, y: page.maxY - 30)); margin.line(to: NSPoint(x: page.minX + 108, y: page.minY + 30))
margin.lineWidth = 6; color(0xd2453f).setStroke(); margin.stroke()
let amountX = right - 120
let col = NSBezierPath(); col.move(to: NSPoint(x: amountX, y: page.maxY - 30)); col.line(to: NSPoint(x: amountX, y: page.minY + 30))
col.lineWidth = 3; color(0xbcc9e3).setStroke(); col.stroke()

// Écritures : libellés à gauche, montants à droite (vert = entrée, rouge = sortie)
let widths: [CGFloat] = [190, 140, 215, 120, 170, 150]
let amountColors: [UInt32] = [0x2c7650, 0xb03838, 0x2c7650, 0x2c7650, 0xb03838, 0x2c7650]
for (i, ry) in rows.enumerated() where i < widths.count {
  color(0x24324f, 0.85).setFill()
  rounded(NSRect(x: page.minX + 128, y: ry + 12, width: widths[i], height: 16), 8).fill()
  color(amountColors[i]).setFill()
  let w: CGFloat = [80, 62, 92, 70, 56, 84][i]
  rounded(NSRect(x: right - w - 8, y: ry + 12, width: w, height: 16), 8).fill()
}
// Total souligné deux fois
let totalY = page.minY + 70
color(0x1d3473).setFill()
rounded(NSRect(x: right - 118, y: totalY + 26, width: 110, height: 24), 9).fill()
for dy in [CGFloat(10), 0] {
  let u = NSBezierPath(); u.move(to: NSPoint(x: right - 124, y: totalY + dy + 4)); u.line(to: NSPoint(x: right - 2, y: totalY + dy + 4))
  u.lineWidth = 5; color(0x1d3473).setStroke(); u.stroke()
}
NSGraphicsContext.restoreGraphicsState()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("Icône : \(out)")
