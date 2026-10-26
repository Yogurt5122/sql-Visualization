SELECT TOP (100)
  o.order_id,
  o.pay_amount,
  u.city
FROM dbo.t_demo_order o
JOIN dbo.t_demo_user_dim u ON u.id = o.user_id
WHERE o.dt >= '2024-12-01'
ORDER BY o.pay_amount DESC;
