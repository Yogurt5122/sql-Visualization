SELECT
  o.order_id,
  o.pay_amount,
  (SELECT MAX(r.refund_amount)
   FROM t_demo_refund r
   WHERE r.order_id = o.order_id) AS max_refund
FROM t_demo_order o
WHERE o.dt = '2024-12-01';
