export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});
  const { text } = req.body || {};
  if (!text || text.length < 20) return res.status(400).json({error: 'Tin BĐS quá ngắn'});
  const JEV_KEY = process.env.JEV_API_KEY;
  if (!JEV_KEY) return res.status(500).json({error: 'Chưa cấu hình JEV_API_KEY trên Vercel'});
  try {
    const jevRes = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${JEV_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: text.slice(0, 6000),
        questions: {
          investment_potential: { type: 'score', instructions: 'Chấm điểm tiềm năng đầu tư BĐS Vũng Tàu', criteria: ['Rất tệ','Thấp','Trung bình','Cao','Rất cao kèo thơm'] },
          is_ngop: { type: 'noul', instructions: 'Có phải bán gấp ngộp bank thanh lý cần tiền gấp không?' },
          legal_safety: { type: 'noul', instructions: 'Pháp lý có an toàn không? sổ hồng riêng không tranh chấp?' },
          location_growth: { type: 'score', instructions: 'Vị trí tiềm năng tăng giá?', criteria: ['Xa trung tâm','Trung bình','Khá','Tốt gần biển trung tâm','Rất tốt mặt tiền biển Thùy Vân Trần Phú'] },
          liquidity: { type: 'score', instructions: 'Thanh khoản dễ bán lại?', criteria: ['Rất khó bán','Khó','Trung bình','Dễ','Rất dễ bán lại'] },
          deal_type: { type: 'choice', instructions: 'Phân loại kèo BĐS', criteria: { ngop_ngon: 'Kèo ngộp ngân hàng giá rẻ hơn thị trường 15%+ - nên mua nhanh', thom_dau_tu: 'Kèo thơm đầu tư tốt giá hợp lý vị trí đẹp', gia_cao: 'Giá cao hơn thị trường', rui_ro_phap_ly: 'Rủi ro pháp lý quy hoạch tranh chấp', binh_thuong: 'Tin bình thường' } }
        }
      })
    });
    const raw = await jevRes.text();
    if (!jevRes.ok) return res.status(jevRes.status).json({error: 'Jev lỗi', detail: raw.slice(0,500)});
    const data = JSON.parse(raw);
    const ans = data.answers || data;
    let invest = ans.investment_potential?.score ?? 0;
    let invest100 = invest <=4 ? Math.round((invest/4)*100) : Math.round(invest);
    return res.status(200).json({
      investment_score: invest100,
      deal_type: ans.deal_type?.choice || 'binh_thuong',
      confidence: ans.deal_type?.confidence || 0.7,
      is_ngop: Math.round((ans.is_ngop?.noul ?? 0)*100),
      legal_safety: Math.round((ans.legal_safety?.noul ?? 0)*100),
      location_growth: ans.location_growth?.score ?? 0,
      liquidity: ans.liquidity?.score ?? 0,
      raw: data
    });
  } catch(e){
    return res.status(500).json({error: e.message});
  }
}
