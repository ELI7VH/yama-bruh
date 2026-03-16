import SwiftUI

/// Animated waveform visualization for real-time audio feedback.
struct WaveformView: View {
    let samples: [Float]
    var color: Color = YBTheme.cyan

    var body: some View {
        Canvas { context, size in
            let midY = size.height / 2
            guard !samples.isEmpty else { return }

            let step = max(1, samples.count / Int(size.width))
            var path = Path()
            path.move(to: CGPoint(x: 0, y: midY))

            for x in 0..<Int(size.width) {
                let idx = min(x * step, samples.count - 1)
                let y = midY - CGFloat(samples[idx]) * midY * 0.85
                path.addLine(to: CGPoint(x: CGFloat(x), y: y))
            }

            context.stroke(path, with: .color(color), lineWidth: 1.5)

            // Center line
            var centerLine = Path()
            centerLine.move(to: CGPoint(x: 0, y: midY))
            centerLine.addLine(to: CGPoint(x: size.width, y: midY))
            context.stroke(centerLine, with: .color(color.opacity(0.15)), lineWidth: 0.5)
        }
    }
}
