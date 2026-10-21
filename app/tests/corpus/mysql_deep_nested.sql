SELECT c.id
FROM (
  SELECT b.id
  FROM (
    SELECT a.id
    FROM (
      SELECT id FROM dwd_order
    ) a
  ) b
) c;
