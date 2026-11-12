// Optional Google sign-in through Firebase Authentication.
// The app works fully without it. Nothing is loaded from Google unless a config is present.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const listeners = [];
let ready = null, user = null;

export const configured = !!firebaseConfig;
export const currentUser = () => user;

function init() {
  if (!configured) return Promise.resolve(null);
  ready ||= Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`)]).then(([app, A]) => {
    const auth = A.getAuth(app.initializeApp(firebaseConfig));
    A.onAuthStateChanged(auth, (u) => {
      user = u ? { uid: u.uid, name: u.displayName || 'Player', email: u.email || '' } : null;
      listeners.forEach((f) => f(user));
    });
    return { A, auth };
  });
  return ready;
}

// Calls back now-and-later with the signed-in user (or null).
export function onUser(f) {
  listeners.push(f);
  init().catch(() => {});
}

export async function signIn() {
  const fb = await init();
  if (!fb) throw new Error('not-configured');
  await fb.A.signInWithPopup(fb.auth, new fb.A.GoogleAuthProvider());
}

export async function signOut() {
  const fb = await init();
  if (fb) await fb.A.signOut(fb.auth);
}
