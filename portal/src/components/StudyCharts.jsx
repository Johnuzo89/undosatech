import React from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell } from 'recharts'

const COLORS=['#1d4ed8','#059669','#7c3aed','#d97706','#dc2626','#0891b2','#65a30d','#9333ea','#f59e0b','#10b981','#6366f1','#ef4444','#14b8a6','#f97316']

export function RoundsChart({ chart }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chart}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
        <XAxis dataKey="round" tick={{fontSize:11,fill:'#9ca3af'}}/>
        <YAxis yAxisId="a" domain={[0,100]} tick={{fontSize:11,fill:'#9ca3af'}} unit="%"/>
        <YAxis yAxisId="l" orientation="right" tick={{fontSize:11,fill:'#9ca3af'}}/>
        <Tooltip formatter={(v,n)=>n==='acc'?`${v}%`:v}/>
        <Legend wrapperStyle={{fontSize:12}}/>
        <Line yAxisId="a" type="monotone" dataKey="acc" name="Accuracy" stroke="#1d4ed8" strokeWidth={2} dot={{r:4}} activeDot={{r:6}}/>
        <Line yAxisId="l" type="monotone" dataKey="loss" name="Loss" stroke="#dc2626" strokeWidth={2} dot={{r:4}} strokeDasharray="4 2"/>
      </LineChart>
    </ResponsiveContainer>
  )
}

export function PerClassChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{top:5,right:10,left:0,bottom:40}}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
        <XAxis dataKey="name" tick={{fontSize:10,fill:'#6b7280'}} angle={-35} textAnchor="end"/>
        <YAxis domain={[0,100]} tick={{fontSize:11,fill:'#9ca3af'}} unit="%"/>
        <Tooltip formatter={v=>`${v}%`}/>
        <Bar dataKey="acc" name="Accuracy" radius={[4,4,0,0]}>{data.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
