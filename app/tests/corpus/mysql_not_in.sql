SELECT id
FROM t_demo_order
WHERE user_id NOT IN (
  SELECT user_id
  FROM t_demo_user_dim
);
