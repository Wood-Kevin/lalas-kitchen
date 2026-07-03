import { spriteLabel } from './spriteLabel';

describe('spriteLabel', () => {
  test('takes the first two characters of the filename, uppercased', () => {
    expect(spriteLabel('tomato.svg')).toBe('TO');
    expect(spriteLabel('lemon.svg')).toBe('LE');
  });

  test('strips the extension before slicing', () => {
    expect(spriteLabel('cling.png')).toBe('CL');
  });

  test('returns a placeholder for an undefined sprite path', () => {
    expect(spriteLabel(undefined)).toBe('?');
  });
});
