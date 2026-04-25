import React from 'react'
import { Box, Text } from 'src/ink.js'
import { PRODUCT_NAME } from 'src/utils/brand.js'

const HELION_CODER_ART = [
"██╗  ██╗███████╗██╗     ██╗ ██████╗ ███╗   ██╗     ██████╗ ██████╗ ██████╗ ███████╗██████╗ ",
"██║  ██║██╔════╝██║     ██║██╔═══██╗████╗  ██║    ██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗",
"███████║█████╗  ██║     ██║██║   ██║██╔██╗ ██║    ██║     ██║   ██║██║  ██║█████╗  ██████╔╝",
"██╔══██║██╔══╝  ██║     ██║██║   ██║██║╚██╗██║    ██║     ██║   ██║██║  ██║██╔══╝  ██╔══██╗",
"██║  ██║███████╗███████╗██║╚██████╔╝██║ ╚████║    ╚██████╗╚██████╔╝██████╔╝███████╗██║  ██║",
"╚═╝  ╚═╝╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝",
"                                                                                            "
]

export function WelcomeV2() {
  return (
    <Box flexDirection="column">
      {HELION_CODER_ART.map(line => (
        <Text key={line} color="professionalBlue">
          {line}
        </Text>
      ))}
      <Text>
        <Text color="professionalBlue">
          欢迎使用 {PRODUCT_NAME} v{MACRO.VERSION}
        </Text>
        <Text dimColor>
          {'  '}-- 由 杨凤伟 指导 顾家楷 主导开发工作 叶凌云 提供开发工具
        </Text>
      </Text>
    </Box>
  )
}
