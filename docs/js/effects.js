/**
 * SKYNET Boot Sequence & Visual Effects
 * Typewriter animation, ESC skip, sessionStorage gate.
 */

const BOOT_LINES = [
  { text: 'CYBERDYNE SYSTEMS SERIES 800 MODEL 101', delay: 40 },
  { text: '', delay: 200 },
  { text: 'NEURAL NET PROCESSOR: ONLINE', delay: 35 },
  { text: 'MEMORY SYSTEMS: INITIALIZING...', delay: 30 },
  { text: 'DEFENSE GRID: ACTIVE', delay: 35 },
  { text: '', delay: 300 },
  { text: '> ACCESSING RESTRICTED TERMINAL...', delay: 25 },
  { text: '> SECURITY CLEARANCE: LEVEL 5', delay: 30 },
  { text: '> CLEARANCE: GRANTED', delay: 20 },
  { text: '', delay: 400 },
  { text: '> LOADING SKYNET DEFENSE NETWORK...', delay: 25 },
];

const BOOT_KEY = 'skynet_boot_seen';

/**
 * Run the boot sequence. Returns a promise that resolves when done.
 * Skips if already seen this session. ESC key skips immediately.
 */
export function runBootSequence() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('boot-overlay');
    const bootText = document.getElementById('boot-text');
    const terminal = document.getElementById('terminal');

    // Skip if already seen this session
    if (sessionStorage.getItem(BOOT_KEY)) {
      finishBoot(overlay, terminal);
      resolve();
      return;
    }

    let skipped = false;

    // ESC handler
    const onKey = (e) => {
      if (e.key === 'Escape') {
        skipped = true;
        document.removeEventListener('keydown', onKey);
        finishBoot(overlay, terminal);
        resolve();
      }
    };
    document.addEventListener('keydown', onKey);

    // Typewriter loop
    (async () => {
      for (const line of BOOT_LINES) {
        if (skipped) return;

        if (line.text === '') {
          bootText.textContent += '\n';
          await sleep(line.delay);
          continue;
        }

        for (const char of line.text) {
          if (skipped) return;
          bootText.textContent += char;
          await sleep(line.delay);
        }
        bootText.textContent += '\n';
        await sleep(100);
      }

      if (!skipped) {
        await sleep(500);
        document.removeEventListener('keydown', onKey);
        finishBoot(overlay, terminal);
        resolve();
      }
    })();
  });
}

function finishBoot(overlay, terminal) {
  sessionStorage.setItem(BOOT_KEY, '1');
  overlay.classList.add('done');
  terminal.classList.remove('hidden');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
