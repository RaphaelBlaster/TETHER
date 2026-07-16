import { createHash } from 'node:crypto'

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024

export function acceptWebSocket(request, socket, head, {
  path = '/v1/responses',
  maxMessageBytes = MAX_MESSAGE_BYTES,
  onText,
  onClose = () => {},
}) {
  const key = request.headers['sec-websocket-key']
  const version = request.headers['sec-websocket-version']
  const upgrade = request.headers.upgrade

  if (request.url !== path || upgrade?.toLowerCase() !== 'websocket' || version !== '13' || typeof key !== 'string') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
    return null
  }

  const accept = createHash('sha1').update(key + WEBSOCKET_GUID).digest('base64')
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n',
  ].join('\r\n'))

  let buffered = Buffer.alloc(0)
  let closed = false
  let closeNotified = false
  let processing = Promise.resolve()

  function notifyClose() {
    if (closeNotified) return
    closeNotified = true
    onClose()
  }

  const peer = {
    sendJson(value) {
      if (!closed) socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(value))))
    },
    ping(payload = 'tether') {
      if (!closed) socket.write(encodeFrame(0x9, Buffer.from(payload).subarray(0, 125)))
    },
    close(code = 1000, reason = '') {
      if (closed) return
      closed = true
      const reasonBytes = Buffer.from(reason).subarray(0, 123)
      const payload = Buffer.allocUnsafe(2 + reasonBytes.length)
      payload.writeUInt16BE(code, 0)
      reasonBytes.copy(payload, 2)
      socket.end(encodeFrame(0x8, payload))
    },
  }

  function fail(code, reason) {
    peer.close(code, reason)
  }

  function consume() {
    while (!closed) {
      const decoded = decodeFrame(buffered, maxMessageBytes)
      if (!decoded) return
      buffered = buffered.subarray(decoded.bytesConsumed)

      if (!decoded.masked) {
        fail(1002, 'client frames must be masked')
        return
      }
      if (!decoded.fin) {
        fail(1003, 'fragmented messages are unsupported')
        return
      }
      if (decoded.opcode === 0x8) {
        peer.close()
        return
      }
      if (decoded.opcode === 0x9) {
        socket.write(encodeFrame(0xA, decoded.payload))
        continue
      }
      if (decoded.opcode === 0xA) continue
      if (decoded.opcode !== 0x1) {
        fail(1003, 'text messages only')
        return
      }

      const text = decoded.payload.toString('utf8')
      processing = processing.then(() => onText(text, peer)).catch(() => {
        fail(1011, 'adapter request failed')
      })
    }
  }

  socket.on('data', (chunk) => {
    if (closed) return
    buffered = Buffer.concat([buffered, chunk])
    if (buffered.length > maxMessageBytes + 14) {
      fail(1009, 'message too large')
      return
    }
    try {
      consume()
    } catch (error) {
      fail(error.code === 'message_too_large' ? 1009 : 1002, error.message)
    }
  })
  socket.on('close', () => {
    closed = true
    notifyClose()
  })
  socket.on('error', () => {
    closed = true
    notifyClose()
  })
  if (head.length) {
    buffered = Buffer.concat([buffered, head])
    consume()
  }
  return peer
}

function decodeFrame(buffer, maxMessageBytes) {
  if (buffer.length < 2) return null
  const first = buffer[0]
  const second = buffer[1]
  const fin = Boolean(first & 0x80)
  const opcode = first & 0x0f
  const masked = Boolean(second & 0x80)
  let payloadLength = second & 0x7f
  let offset = 2

  if (payloadLength === 126) {
    if (buffer.length < 4) return null
    payloadLength = buffer.readUInt16BE(2)
    offset = 4
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null
    const high = buffer.readUInt32BE(2)
    const low = buffer.readUInt32BE(6)
    if (high !== 0 || low > maxMessageBytes) throw coded('message_too_large', 'message too large')
    payloadLength = low
    offset = 10
  }

  if (payloadLength > maxMessageBytes) throw coded('message_too_large', 'message too large')
  const maskLength = masked ? 4 : 0
  const frameLength = offset + maskLength + payloadLength
  if (buffer.length < frameLength) return null

  const payload = Buffer.from(buffer.subarray(offset + maskLength, frameLength))
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4)
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4]
  }
  return { fin, opcode, masked, payload, bytesConsumed: frameLength }
}

function encodeFrame(opcode, payload) {
  let header
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length])
  } else if (payload.length <= 0xffff) {
    header = Buffer.allocUnsafe(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.allocUnsafe(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeUInt32BE(0, 2)
    header.writeUInt32BE(payload.length, 6)
  }
  return Buffer.concat([header, payload])
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
