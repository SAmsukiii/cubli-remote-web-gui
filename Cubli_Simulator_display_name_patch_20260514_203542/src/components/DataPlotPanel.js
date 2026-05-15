import React from 'react';
import { Card, Button } from 'react-bootstrap';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function DataPlotPanel({ dataHistory, downloadCSV }) {
  return (
    <Card className="bg-dark text-light border-secondary shadow mt-3">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h5 className="text-success fw-bold m-0">📊 실시간 자세 데이터 (로깅)</h5>
          <Button variant="outline-success" size="sm" onClick={downloadCSV} className="fw-bold">
            💾 CSV 다운로드
          </Button>
        </div>
        
        <div style={{ width: '100%', height: '220px' }}>
          <ResponsiveContainer>
            <LineChart data={dataHistory} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#444" />
              <XAxis dataKey="time" stroke="#aaa" tick={{fontSize: 12}} />
              <YAxis stroke="#aaa" domain={['-180', '180']} tick={{fontSize: 12}} />
              <Tooltip contentStyle={{ backgroundColor: '#222', border: '1px solid #555', color: '#fff' }} />
              <Legend wrapperStyle={{ fontSize: '14px' }}/>
              <Line type="monotone" dataKey="pitch" stroke="#ff7300" strokeWidth={2} dot={false} isAnimationActive={false} name="Pitch (X)" />
              <Line type="monotone" dataKey="yaw" stroke="#387908" strokeWidth={2} dot={false} isAnimationActive={false} name="Yaw (Y)" />
              <Line type="monotone" dataKey="roll" stroke="#0088fe" strokeWidth={2} dot={false} isAnimationActive={false} name="Roll (Z)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card.Body>
    </Card>
  );
}