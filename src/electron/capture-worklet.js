class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input[0]) {
      const L = input[0], R = input[1] || input[0]
      const out = new Float32Array(L.length * 2)
      for (let i = 0; i < L.length; i++) { out[i*2]=L[i]; out[i*2+1]=R[i] }
      this.port.postMessage(out.buffer, [out.buffer])
    }
    return true
  }
}
registerProcessor('capture-processor', CaptureProcessor)
