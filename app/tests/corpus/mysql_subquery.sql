SELECT o.order_id, o.pay_amount
FROM t_demo_order o
WHERE o.user_id IN (
  SELECT user_id
  FROM t_demo_user_dim
  WHERE vip_level >= 3
)
AND o.dt = '2024-12-01';
