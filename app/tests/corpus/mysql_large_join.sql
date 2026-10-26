SELECT
  o.order_id,
  o.pay_amount,
  u.city,
  p.product_name,
  c.channel_name
FROM t_demo_order o
JOIN t_demo_user_dim u ON u.id = o.user_id
JOIN t_demo_product p ON p.id = o.product_id
JOIN t_demo_channel c ON c.id = o.channel_id
LEFT JOIN t_demo_refund r ON r.order_id = o.order_id
WHERE o.dt >= '2024-12-01'
  AND o.status IN ('PAID', 'SHIPPED')
  AND (r.refund_id IS NULL OR r.refund_status = 'REJECTED')
ORDER BY o.pay_amount DESC
LIMIT 200;
