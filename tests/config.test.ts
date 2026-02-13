import { describe, it, expect } from 'vitest';
import { parseArgs, ServerConfig } from '../src/config.js';
import * as os from 'node:os';
import * as path from 'node:path';

function parse(...flags: string[]): ServerConfig {
  return parseArgs(['node', 'index.js', ...flags]);
}

describe('parseArgs', () => {
  describe('defaults', () => {
    it('returns both mode by default', () => {
      expect(parse().mode).toBe('both');
    });

    it('enables viz by default', () => {
      expect(parse().vizEnabled).toBe(true);
    });

    it('enables approval by default', () => {
      expect(parse().approvalEnabled).toBe(true);
    });

    it('uses maxDepth 5 for both mode', () => {
      expect(parse().maxDepth).toBe(5);
    });

    it('uses OS temp dir for outputDir', () => {
      expect(parse().outputDir).toBe(path.join(os.tmpdir(), 'aot-diagrams'));
    });

    it('uses ~/Downloads for downloadsDir', () => {
      expect(parse().downloadsDir).toBe(path.join(os.homedir(), 'Downloads'));
    });
  });

  describe('--mode', () => {
    it('accepts full', () => {
      expect(parse('--mode', 'full').mode).toBe('full');
    });

    it('accepts fast', () => {
      expect(parse('--mode', 'fast').mode).toBe('fast');
    });

    it('accepts both', () => {
      expect(parse('--mode', 'both').mode).toBe('both');
    });

    it('throws on invalid mode', () => {
      expect(() => parse('--mode', 'turbo')).toThrow('Invalid --mode');
    });

    it('throws on missing mode value', () => {
      expect(() => parse('--mode')).toThrow('Invalid --mode');
    });

    it('sets maxDepth 3 for fast mode', () => {
      expect(parse('--mode', 'fast').maxDepth).toBe(3);
    });

    it('sets maxDepth 5 for full mode', () => {
      expect(parse('--mode', 'full').maxDepth).toBe(5);
    });
  });

  describe('--no-viz', () => {
    it('disables viz', () => {
      expect(parse('--no-viz').vizEnabled).toBe(false);
    });

    it('also disables approval', () => {
      expect(parse('--no-viz').approvalEnabled).toBe(false);
    });
  });

  describe('--no-approval', () => {
    it('disables approval', () => {
      expect(parse('--no-approval').approvalEnabled).toBe(false);
    });

    it('keeps viz enabled', () => {
      expect(parse('--no-approval').vizEnabled).toBe(true);
    });
  });

  describe('--max-depth', () => {
    it('overrides default depth', () => {
      expect(parse('--max-depth', '10').maxDepth).toBe(10);
    });

    it('overrides fast mode default', () => {
      expect(parse('--mode', 'fast', '--max-depth', '7').maxDepth).toBe(7);
    });

    it('throws on non-integer', () => {
      expect(() => parse('--max-depth', '2.5')).toThrow('Invalid --max-depth');
    });

    it('throws on zero', () => {
      expect(() => parse('--max-depth', '0')).toThrow('Invalid --max-depth');
    });

    it('throws on negative', () => {
      expect(() => parse('--max-depth', '-1')).toThrow('Invalid --max-depth');
    });

    it('throws on missing value', () => {
      expect(() => parse('--max-depth')).toThrow('Invalid --max-depth');
    });
  });

  describe('--output-dir', () => {
    it('sets custom output directory', () => {
      expect(parse('--output-dir', '/tmp/my-aot').outputDir).toBe('/tmp/my-aot');
    });

    it('throws on missing value', () => {
      expect(() => parse('--output-dir')).toThrow('--output-dir requires');
    });
  });

  describe('--downloads-dir', () => {
    it('sets custom downloads directory', () => {
      expect(parse('--downloads-dir', '/tmp/dl').downloadsDir).toBe('/tmp/dl');
    });

    it('throws on missing value', () => {
      expect(() => parse('--downloads-dir')).toThrow('--downloads-dir requires');
    });
  });

  describe('combinations', () => {
    it('handles all flags together', () => {
      const config = parse(
        '--mode', 'full',
        '--no-approval',
        '--max-depth', '8',
        '--output-dir', '/out',
        '--downloads-dir', '/dl'
      );
      expect(config.mode).toBe('full');
      expect(config.vizEnabled).toBe(true);
      expect(config.approvalEnabled).toBe(false);
      expect(config.maxDepth).toBe(8);
      expect(config.outputDir).toBe('/out');
      expect(config.downloadsDir).toBe('/dl');
    });

    it('ignores unknown flags', () => {
      const config = parse('--verbose', '--debug');
      expect(config.mode).toBe('both');
    });
  });
});
