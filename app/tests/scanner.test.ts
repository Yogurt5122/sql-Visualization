import { describe, expect, it } from 'vitest';
import { scan } from '../src/core/scanner';

describe('scan', () => {
  it('识别关键字、标识符、数字与字符串', () => {
    const { tokens, errors } = scan("SELECT id, 'a;b' FROM t WHERE n = 42;");
    expect(errors).toHaveLength(0);
    expect(tokens.some((token) => token.text === 'SELECT' && token.kind === 'keyword')).toBe(
      true,
    );
    expect(tokens.find((token) => token.text === "'a;b'")?.kind).toBe('string');
    expect(tokens.find((token) => token.text === '42')?.kind).toBe('number');
  });

  it('注释里的关键字不会被当成 token', () => {
    const { tokens } = scan('-- SELECT * FROM t\nSELECT 1');
    const keywords = tokens
      .filter((token) => token.kind === 'keyword')
      .map((token) => token.text.toUpperCase());
    expect(keywords).toEqual(['SELECT']);
  });

  it('支持反引号、方括号与参数占位符', () => {
    const { tokens } = scan('SELECT `a`, [b], #{id}, :name FROM t');
    expect(tokens.filter((token) => token.kind === 'quotedIdent').map((token) => token.text)).toEqual(
      ['`a`', '[b]'],
    );
    expect(tokens.filter((token) => token.kind === 'param')).toHaveLength(2);
  });

  it('未闭合字符串会报错，但 token 仍然产出', () => {
    const { tokens, errors } = scan("SELECT 'oops");
    expect(tokens.some((token) => token.kind === 'string')).toBe(true);
    expect(errors[0]?.message).toContain('字符串未闭合');
  });

  it('括号不配平会记录错误', () => {
    const { errors } = scan('SELECT (1 + 2');
    expect(errors.some((error) => error.message.includes('括号未闭合'))).toBe(true);
  });

  it('行号从 1 开始且准确', () => {
    const { tokens } = scan('SELECT 1\nFROM t');
    expect(tokens.find((token) => token.text.toUpperCase() === 'FROM')?.line).toBe(2);
  });

  it('不会把字符串里的分号当成语句边界', () => {
    const { tokens } = scan("SELECT ';' AS s;");
    const semicolons = tokens.filter((token) => token.text === ';');
    expect(semicolons).toHaveLength(1);
    expect(semicolons[0]?.depth).toBe(0);
  });
});
