SELECT a.id
FROM dm_a a, dm_b b
WHERE a.id = b.id(+)
  AND b.status = 1;
