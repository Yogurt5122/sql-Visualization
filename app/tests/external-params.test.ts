import { describe, expect, it } from 'vitest';
import {
  annotateExternalParameters,
  collectExternalParameters,
  externalParameterName,
} from '../src/core/external-params';
import { analyzeSql } from '../src/core/explain';

describe('外部参数 <!name!>', () => {
  it('识别字符串里的参数并保留行号', () => {
    const sql = `SELECT NVL(LENGTH('<!demo_filter!>'), 0)
FROM t_demo_order
WHERE NVL(LENGTH('<!demo_filter!>'), 0) > 0`;
    const parameters = collectExternalParameters(sql);

    expect(parameters.map((parameter) => parameter.name)).toEqual([
      'demo_filter',
      'demo_filter',
    ]);
    expect(parameters.map((parameter) => parameter.line)).toEqual([1, 3]);
    expect(parameters[0]?.raw).toBe('<!demo_filter!>');
    expect(externalParameterName("'<!demo_filter!>'")).toBe('demo_filter');
  });

  it('解释文案不把参数说成普通字符串', () => {
    const sql = `SELECT NVL(LENGTH('<!demo_filter!>'), 0) AS value_1
FROM t_demo_order
WHERE NVL(LENGTH('<!demo_filter!>'), 0) > 0`;
    const analysis = analyzeSql(sql, 'mysql');

    expect(analysis.parameters).toHaveLength(2);
    expect(analysis.relations[0]?.lineage[0]?.source).toBe(
      '外部参数 demo_filter',
    );
    expect(analysis.summary).toContain('外部参数：demo_filter');
    expect(
      analysis.explanations.some((explanation) =>
        explanation.plain.includes('外部参数 demo_filter'),
      ),
    ).toBe(true);
    expect(annotateExternalParameters("NVL(LENGTH('<!demo_filter!>'), 0)")).toBe(
      'NVL(LENGTH(外部参数 demo_filter), 0)',
    );
  });

  it('只有字符串 token 才算参数，注释里的不算', () => {
    const parameters = collectExternalParameters(
      `-- '<!commented_param!>'
SELECT '<!used_param!>' FROM t_demo_order`,
    );

    expect(parameters.map((parameter) => parameter.name)).toEqual(['used_param']);
  });
});
