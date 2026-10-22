const MYBATIS_TAG =
  /<\/?(select|insert|update|delete|if|choose|when|otherwise|where|set|trim|foreach|include|sql)\b/i;

export function containsMybatisTags(sql: string): boolean {
  return MYBATIS_TAG.test(sql);
}
