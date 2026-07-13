import { setInjectionEnabled } from '../lib/config.js';

export default async function on() {
  setInjectionEnabled(true);
  console.log('injection ON — hooks will add matching lesson headlines to sessions (raph why shows each one)');
  return 0;
}
