SELECT c.id
FROM (
  SELECT b.id
  FROM (
    SELECT a.id
    FROM (
      SELECT id FROM t_demo_order
    ) a
  ) b
) c;
