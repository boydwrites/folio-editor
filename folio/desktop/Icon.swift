import AppKit

// Read the existing logo rather than keep an approximate second drawing of it.
// Every icon representation is rendered from these vectors at its final size.
let source = try XMLDocument(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]), options: [])
let destination = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let root = source.rootElement()!
let viewBox = root.attribute(forName: "viewBox")!.stringValue!.split(separator: " ").map { CGFloat(Double($0)!) }
let elements = root.children!.compactMap { $0 as? XMLElement }

func attribute(_ element: XMLElement, _ name: String) -> String {
    element.attribute(forName: name)!.stringValue!
}

func color(_ hex: String) -> NSColor {
    let value = UInt32(hex.dropFirst(), radix: 16)!
    return NSColor(srgbRed: CGFloat((value >> 16) & 255) / 255,
                   green: CGFloat((value >> 8) & 255) / 255,
                   blue: CGFloat(value & 255) / 255, alpha: 1)
}

func path(_ data: String) throws -> NSBezierPath {
    // The logo uses straight SVG segments. Fail clearly if the logo is
    // replaced with a shape that needs a different renderer.
    let expression = try NSRegularExpression(pattern: "[A-Za-z]|[-+]?(?:[0-9]*\\.)?[0-9]+")
    let tokens = expression.matches(in: data, range: NSRange(data.startIndex..., in: data)).map {
        String(data[Range($0.range, in: data)!])
    }
    let result = NSBezierPath()
    var cursor = NSPoint.zero, index = 0, command = ""
    func number() -> CGFloat { defer { index += 1 }; return CGFloat(Double(tokens[index])!) }
    while index < tokens.count {
        if tokens[index].first!.isLetter { command = tokens[index]; index += 1 }
        switch command {
        case "M", "m", "L", "l":
            let relative = command == command.lowercased()
            let point = NSPoint(x: number(), y: number())
            cursor = relative ? NSPoint(x: cursor.x + point.x, y: cursor.y + point.y) : point
            if command.uppercased() == "M" { result.move(to: cursor); command = relative ? "l" : "L" }
            else { result.line(to: cursor) }
        case "H", "h":
            cursor.x = command == "h" ? cursor.x + number() : number()
            result.line(to: cursor)
        case "V", "v":
            cursor.y = command == "v" ? cursor.y + number() : number()
            result.line(to: cursor)
        case "Z", "z": result.close(); command = ""
        default:
            throw NSError(domain: "FolioIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported logo path command: \(command)"])
        }
    }
    return result
}

let background = color(attribute(elements.first { $0.name == "rect" }!, "fill"))
var marks: [(NSBezierPath, NSColor)] = []
for element in elements {
    if element.name == "path" {
        marks.append((try path(attribute(element, "d")), color(attribute(element, "fill"))))
    } else if element.name == "circle" {
        let x = CGFloat(Double(attribute(element, "cx"))!), y = CGFloat(Double(attribute(element, "cy"))!)
        let radius = CGFloat(Double(attribute(element, "r"))!)
        marks.append((NSBezierPath(ovalIn: NSRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2)),
                      color(attribute(element, "fill"))))
    }
}

// A continuous corner curve fits macOS app tiles better than circular corners.
func tile(_ rect: NSRect) -> NSBezierPath {
    let shape = NSBezierPath()
    let corner = rect.width * 0.225, control = corner * 0.44
    let x = rect.minX, y = rect.minY, right = rect.maxX, top = rect.maxY
    shape.move(to: NSPoint(x: x + corner, y: y))
    shape.line(to: NSPoint(x: right - corner, y: y))
    shape.curve(to: NSPoint(x: right, y: y + corner), controlPoint1: NSPoint(x: right - control, y: y), controlPoint2: NSPoint(x: right, y: y + control))
    shape.line(to: NSPoint(x: right, y: top - corner))
    shape.curve(to: NSPoint(x: right - corner, y: top), controlPoint1: NSPoint(x: right, y: top - control), controlPoint2: NSPoint(x: right - control, y: top))
    shape.line(to: NSPoint(x: x + corner, y: top))
    shape.curve(to: NSPoint(x: x, y: top - corner), controlPoint1: NSPoint(x: x + control, y: top), controlPoint2: NSPoint(x: x, y: top - control))
    shape.line(to: NSPoint(x: x, y: y + corner))
    shape.curve(to: NSPoint(x: x + corner, y: y), controlPoint1: NSPoint(x: x, y: y + control), controlPoint2: NSPoint(x: x + control, y: y))
    shape.close()
    return shape
}

func render(_ pixels: Int, to file: URL) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.current = context
    context.shouldAntialias = true
    context.cgContext.clear(CGRect(x: 0, y: 0, width: pixels, height: pixels))
    let canvas = CGFloat(pixels)
    let frame = NSRect(x: canvas * 0.09375, y: canvas * 0.09375, width: canvas * 0.8125, height: canvas * 0.8125)
    background.setFill()
    tile(frame).fill()
    let logoScale = canvas * 0.875 / viewBox[2]
    let transform = AffineTransform(m11: logoScale, m12: 0, m21: 0, m22: -logoScale,
                                    tX: canvas * 0.0625 - viewBox[0] * logoScale,
                                    tY: canvas * 0.9375 + viewBox[1] * logoScale)
    for (mark, ink) in marks {
        let vector = mark.copy() as! NSBezierPath
        vector.transform(using: transform)
        ink.setFill()
        vector.fill()
    }
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: file)
}

try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let suffix = scale == 2 ? "@2x" : ""
        try render(size * scale, to: destination.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
