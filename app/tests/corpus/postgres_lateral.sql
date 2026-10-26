SELECT u.user_id, x.order_id, x.pay_amount
FROM t_demo_user_dim u
LEFT JOIN LATERAL (
  SELECT order_id, pay_amount
  FROM t_demo_order o
  WHERE o.user_id = u.user_id
  ORDER BY o.created_at DESC
  LIMIT 3
) x ON true
WHERE u.status = 1;
