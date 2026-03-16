import SwiftUI

/// Red 7-segment style LED display, matching the PSS-470 aesthetic.
struct LEDDisplayView: View {
    let presetNumber: Int
    let presetName: String
    var category: String = ""
    var status: String = ""

    var body: some View {
        VStack(spacing: 4) {
            HStack {
                // Preset number in red LED
                Text(String(format: "%02d", presetNumber))
                    .font(YBTheme.led)
                    .foregroundColor(YBTheme.red)
                    .shadow(color: YBTheme.red.opacity(0.5), radius: 4)

                Spacer()

                // Category label
                if !category.isEmpty {
                    Text(category)
                        .font(YBTheme.caption)
                        .foregroundColor(YBTheme.cyan.opacity(0.5))
                }
            }

            HStack {
                Text(presetName)
                    .font(YBTheme.ledSmall)
                    .foregroundColor(YBTheme.red.opacity(0.9))

                Spacer()

                if !status.isEmpty {
                    Text(status)
                        .font(YBTheme.caption)
                        .foregroundColor(YBTheme.green)
                }
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.black)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(YBTheme.surface, lineWidth: 2)
                )
        )
    }
}
