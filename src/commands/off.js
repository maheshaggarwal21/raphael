import { setInjectionEnabled } from '../lib/config.js';

export default async function off() {
  setInjectionEnabled(false);
  console.log('injection OFF — hooks stay silent; mining, review, and raph search still work (raph on re-enables)');
  return 0;
}
