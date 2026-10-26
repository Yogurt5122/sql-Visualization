SELECT DISTINCT ON (user_id)
  user_id,
  order_id,
  created_at
FROM t_demo_order
WHERE status = 'PAID'
ORDER BY user_id, created_at DESC;
