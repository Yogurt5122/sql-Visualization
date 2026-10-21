SELECT TOP (100)
  o.order_id,
  o.pay_amount,
  u.city
FROM dbo.dwd_order o
JOIN dbo.dim_user u ON u.id = o.user_id
WHERE o.dt >= '2024-12-01'
ORDER BY o.pay_amount DESC;
