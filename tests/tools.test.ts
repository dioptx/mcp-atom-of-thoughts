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

  it('returns exactly 3 tools', () => {
    expect(tools).toHaveLength(3);
  });

  it('has correct tool names in correct order', () => {
    const names = tools.map(t => t.name);
    expect(names).toEqual(['AoT-fast', 'AoT-full', 'atomcommands']);
  });

  it('each tool has name, description, inputSchema', () => {
    tools.forEach(tool => {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    });
  });

  it('AoT-fast requires atomId, content, atomType', () => {
    const aot = tools.find(t => t.name === 'AoT-fast')!;
    expect(aot.inputSchema.required).toEqual(['atomId', 'content', 'atomType']);
  });

  it('AoT-full requires atomId, content, atomType', () => {
    const aot = tools.find(t => t.name === 'AoT-full')!;
    expect(aot.inputSchema.required).toEqual(['atomId', 'content', 'atomType']);
  });

  it('atomcommands requires command', () => {
    const cmd = tools.find(t => t.name === 'atomcommands')!;
    expect(cmd.inputSchema.required).toEqual(['command']);
  });

  it('atomcommands enum includes folded subcommands', () => {
    const cmd = tools.find(t => t.name === 'atomcommands')!;
    const commandProp = (cmd.inputSchema.properties as Record<string, { enum?: string[] }>).command;
    expect(commandProp.enum).toEqual(expect.arrayContaining([
      'decompose',
      'complete_decomposition',
      'termination_status',
      'best_conclusion',
      'set_max_depth',
      'export',
      'check_approval',
    ]));
  });

  it('v2 tool names are removed', () => {
    const names = tools.map(t => t.name);
    expect(names).not.toContain('AoT');
    expect(names).not.toContain('AoT-light');
    expect(names).not.toContain('generate_visualization');
    expect(names).not.toContain('check_approval');
    expect(names).not.toContain('export_graph');
  });
});

describe('getTools', () => {
  it('returns all 3 tools with default (both) mode', () => {
    const tools = getTools(makeConfig());
    expect(tools).toHaveLength(3);
    expect(tools.map(t => t.name)).toEqual(['AoT-fast', 'AoT-full', 'atomcommands']);
  });

  it('--mode full excludes AoT-fast', () => {
    const tools = getTools(makeConfig({ mode: 'full' }));
    const names = tools.map(t => t.name);
    expect(names).toContain('AoT-full');
    expect(names).not.toContain('AoT-fast');
    expect(names).toContain('atomcommands');
    expect(tools).toHaveLength(2);
  });

  it('--mode fast excludes AoT-full', () => {
    const tools = getTools(makeConfig({ mode: 'fast' }));
    const names = tools.map(t => t.name);
    expect(names).toContain('AoT-fast');
    expect(names).not.toContain('AoT-full');
    expect(names).toContain('atomcommands');
    expect(tools).toHaveLength(2);
  });

  it('--mode both puts AoT-fast before AoT-full', () => {
    const tools = getTools(makeConfig({ mode: 'both' }));
    const names = tools.map(t => t.name);
    expect(names.indexOf('AoT-fast')).toBeLessThan(names.indexOf('AoT-full'));
  });

  it('atomcommands is always present', () => {
    expect(getTools(makeConfig({ mode: 'fast' })).map(t => t.name)).toContain('atomcommands');
    expect(getTools(makeConfig({ mode: 'full' })).map(t => t.name)).toContain('atomcommands');
    expect(getTools(makeConfig({ mode: 'both' })).map(t => t.name)).toContain('atomcommands');
  });
});
