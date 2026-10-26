SELECT order_id FROM t_demo_order
UNION ALL
SELECT refund_id FROM t_demo_refund
UNION
SELECT payment_id FROM t_demo_payment;
