# Effect model sources

Both models are the official Google MediaPipe releases (Apache-2.0), self-hosted with the site
so the live-stream effects never load anything from a third-party server (see `../engine.ts`).

| File | Source | sha256 |
|---|---|---|
| `selfie_segmenter.tflite` | https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite | `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b` |
| `face_landmarker.task` | https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
