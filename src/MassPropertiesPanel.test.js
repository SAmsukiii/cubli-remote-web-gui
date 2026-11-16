import React from 'react';
import {render,screen,fireEvent,within,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom';
import MassPropertiesPanel from './MassPropertiesPanel';
jest.mock('./massProperties/workerFactory',()=>({createAnalysisWorker:jest.fn()}));
beforeEach(()=>localStorage.clear());
test('offline CG entry computes, invalid edits cannot save a stale result',()=>{
  render(<MassPropertiesPanel/>);
  const fields=['P1 [g]','P2 [g]','P3 [g]'];
  fields.forEach((label,i)=>fireEvent.change(screen.getByLabelText(label),{target:{value:[248,248,496][i]}}));
  expect(screen.getByTestId('cg-result')).toHaveTextContent('dx 0 mm · dy 0 mm');
  fireEvent.click(screen.getByRole('button',{name:'CG 기록 저장'}));
  expect(JSON.parse(localStorage.getItem('cubli.mass-properties.v3'))[0].resultSI.massKg).toBe(0.992);
  fireEvent.change(screen.getByLabelText(fields[0]),{target:{value:''}});
  expect(screen.queryByRole('button',{name:'CG 기록 저장'})).not.toBeInTheDocument();
  expect(screen.queryByTestId('cg-result')).not.toBeInTheDocument();
});
test('analysis UI is available without granting control or making network calls',()=>{
  const fetchMock=jest.fn();global.fetch=fetchMock;
  render(<MassPropertiesPanel/>);
  fireEvent.click(screen.getByRole('button',{name:'관성·마찰 식별'}));
  expect(screen.getByLabelText('낙하추 질량 [kg]')).toBeVisible();
  expect(screen.getByRole('button',{name:'관성·마찰 계산'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'예제 불러오기'}));
  expect(screen.getByText(/합성_200Hz_검증.csv/)).toBeVisible();
  expect(screen.getByRole('button',{name:'관성·마찰 계산'})).toBeEnabled();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'기록·비교'}));
  expect(within(screen.getByRole('table')).queryAllByRole('row')).toHaveLength(1);
});

test('center loads appear without entering measured readings and survive a unit change', () => {
  render(<MassPropertiesPanel/>);
  fireEvent.change(screen.getByLabelText('판 질량 [g]'), { target: { value: '108' } });
  const cells = name => within(screen.getByRole('row', { name })).getAllByRole('cell').map(cell => cell.textContent);
  expect(cells(/판만/)).toEqual(['27', '27', '54']);
  fireEvent.change(screen.getByLabelText('기준물체 질량 [g]'), { target: { value: '992' } });
  expect(cells(/기준물체만/)).toEqual(['248', '248', '496']);
  expect(cells(/판 \+ 기준물체/)).toEqual(['275', '275', '550']);
  fireEvent.change(screen.getByLabelText('입력 질량 단위'), { target: { value: 'kg' } });
  expect(cells(/판 \+ 기준물체/)).toEqual(['0.275', '0.275', '0.55']);
});

test('unknown CSV time unit is requested before running the fit', async () => {
  render(<MassPropertiesPanel/>);
  fireEvent.click(screen.getByRole('button', { name: '관성·마찰 식별' }));
  fireEvent.change(screen.getByLabelText('낙하추 질량 [kg]'), { target: { value: '0.03' } });
  fireEvent.change(screen.getByLabelText('유효 반경 [m]'), { target: { value: '0.18' } });
  fireEvent.change(screen.getByLabelText('엔코더 CSV'), {
    target: { files: [{ name: 'unknown-time.csv', text: async () => 'time,angle_deg\n0,0\n5,1' }] },
  });
  await waitFor(() => expect(screen.getByText('unknown-time.csv')).toBeVisible());
  const calculate = screen.getByRole('button', { name: '관성·마찰 계산' });
  expect(calculate).toBeDisabled();
  fireEvent.change(screen.getByLabelText('CSV 시간 단위'), { target: { value: 'ms' } });
  expect(calculate).toBeEnabled();
});
