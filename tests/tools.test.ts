import { describe, it, expect } from 'vitest';
import { getAllTools, getTools } from '../src/tools.js';
import type { ServerConfig } from '../src/config.js';

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    mode: 'both',
    vizEnabled: true,
    approvalEnabled: true,
    maxDepth: 5,
    outputDir: '/tmp/aot',
    downloadsDir: '/tmp/dl',
    ...overrides,
  };
}

describe('getAllTools', () => {
  const tools = getAllTools();

  it('returns exactly 6 tools', () => {
    expect(tools).toHaveLength(6);
  });

  it('has correct tool names', () => {
    const names = tools.map(t => t.name);
    expect(names).toEqual([
      'AoT',
      'AoT-light',
      'atomcommands',
      'export_graph',
      'generate_visualization',
      'check_approval',
    ]);
  });

  it('each tool has name, description, inputSchema', () => {
    tools.forEach(tool => {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    });
  });

  it('AoT tool requires atomId, content, atomType, dependencies, confidence', () => {
    const aot = tools.find(t => t.name === 'AoT')!;
    expect(aot.inputSchema.required).toEqual(['atomId', 'content', 'atomType', 'dependencies', 'confidence']);
  });

  it('atomcommands tool requires command', () => {
    const cmd = tools.find(t => t.name === 'atomcommands')!;
    expect(cmd.inputSchema.required).toEqual(['command']);
  });

  it('export_graph has optional title', () => {
    const exp = tools.find(t => t.name === 'export_graph')!;
    expect(exp.inputSchema.required).toBeUndefined();
  });
});

describe('getTools', () => {
  it('returns all 6 tools with default config', () => {
    const tools = getTools(makeConfig());
    expect(tools).toHaveLength(6);
  });

  it('--mode full excludes AoT-light', () => {
    const tools = getTools(makeConfig({ mode: 'full' }));
    const names = tools.map(t => t.name);
    expect(names).toContain('AoT');
    expect(names).not.toContain('AoT-light');
  });

  it('--mode fast excludes AoT', () => {
    const tools = getTools(makeConfig({ mode: 'fast' }));
    const names = tools.map(t => t.name);
    expect(names).not.toContain('AoT');
    expect(names).toContain('AoT-light');
  });

  it('--mode both includes both AoT tools', () => {
    const tools = getTools(makeConfig({ mode: 'both' }));
    const names = tools.map(t => t.name);
    expect(names).toContain('AoT');
    expect(names).toContain('AoT-light');
  });

  it('always includes atomcommands and export_graph', () => {
    const tools = getTools(makeConfig({ mode: 'fast', vizEnabled: false, approvalEnabled: false }));
    const names = tools.map(t => t.name);
    expect(names).toContain('atomcommands');
    expect(names).toContain('export_graph');
  });

  it('vizEnabled=false removes generate_visualization', () => {
    const tools = getTools(makeConfig({ vizEnabled: false, approvalEnabled: false }));
    const names = tools.map(t => t.name);
    expect(names).not.toContain('generate_visualization');
  });

  it('approvalEnabled=false removes check_approval', () => {
    const tools = getTools(makeConfig({ approvalEnabled: false }));
    const names = tools.map(t => t.name);
    expect(names).not.toContain('check_approval');
  });

  it('vizEnabled=true but approvalEnabled=false keeps viz, removes approval', () => {
    const tools = getTools(makeConfig({ approvalEnabled: false }));
    const names = tools.map(t => t.name);
    expect(names).toContain('generate_visualization');
    expect(names).not.toContain('check_approval');
  });

  it('--mode fast --no-viz returns only 3 tools', () => {
    const tools = getTools(makeConfig({ mode: 'fast', vizEnabled: false, approvalEnabled: false }));
    expect(tools).toHaveLength(3);
    expect(tools.map(t => t.name)).toEqual(['AoT-light', 'atomcommands', 'export_graph']);
  });
});
