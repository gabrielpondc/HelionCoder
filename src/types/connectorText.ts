export type ConnectorTextBlock = {
  type: 'connector_text'
  connector_text: string
  id?: string
  name?: string
}

export type ConnectorTextDelta = {
  type: 'connector_text_delta'
  connector_text: string
}

export function isConnectorTextBlock(
  value: unknown,
): value is ConnectorTextBlock {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as {
    type?: unknown
    connector_text?: unknown
  }

  return (
    candidate.type === 'connector_text' &&
    typeof candidate.connector_text === 'string'
  )
}
