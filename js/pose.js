// Body tracking. Loads Google's MediaPipe pose model the first time it is needed (about 6 MB),
// then runs on the phone itself: no video leaves the device.
const VER = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let ready = null, lastTs = 0;

export function loadPose() {
  ready ||= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import(`${VER}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${VER}/wasm`);
    const make = (delegate) => PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1,
    });
    try { return await make('GPU'); } catch { return make('CPU'); } // older phones have no usable graphics chip for this
  })();
  ready.catch(() => { ready = null; }); // let a later tap try again
  return ready;
}

// Returns the 33 body points for the main person in the frame, or null if nobody is found.
export async function detect(video) {
  const pose = await loadPose();
  const ts = Math.max(lastTs + 1, performance.now()); // the model needs timestamps that always go up
  lastTs = ts;
  const res = pose.detectForVideo(video, ts);
  return res.landmarks && res.landmarks[0] ? res.landmarks[0] : null;
}
