SELECT o.order_id, SUM(o.pay_amount) AS gmv
FROM dwd_order o
WHERE o.dt = '2024-12-01'
  AND (o.status = 'PAID'
GROUP BY o.order_id;
