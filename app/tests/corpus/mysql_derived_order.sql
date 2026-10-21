SELECT t.id, t.amount
FROM (
  SELECT id, amount
  FROM dwd_order
  WHERE dt = '2024-12-01'
  ORDER BY amount DESC
) t
LIMIT 100;
