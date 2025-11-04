"""
ResGCN_Improved 모델 정의
PyTorch Geometric 기반의 Graph Convolutional Network 모델
실제 체크포인트 구조에 맞게 수정됨
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GCNConv, BatchNorm
from torch_geometric.nn.pool import global_mean_pool
from torch_geometric.data import Data, Batch


class ResBlock(nn.Module):
    """Residual Block for GCN - 노트북 구조와 동일하게 수정"""
    def __init__(self, in_ch, out_ch):
        super(ResBlock, self).__init__()
        self.conv = GCNConv(in_ch, out_ch, bias=True)  # -> conv.lin.weight / conv.bias
        self.bn = BatchNorm(out_ch)  # -> bn.module.*
        self.res_proj = None
        if in_ch != out_ch:
            self.res_proj = nn.Linear(in_ch, out_ch)  # -> res_proj.weight/bias
        
    def forward(self, x, edge_index):
        out = self.conv(x, edge_index)
        out = self.bn(out)
        out = F.relu(out, inplace=True)
        res = x if self.res_proj is None else self.res_proj(x)
        return out + res


class ResGCN_Improved(nn.Module):
    """ResGCN Improved 모델 - 노트북 구조와 동일하게 수정"""
    def __init__(self, in_dim, hidden, num_classes, num_blocks=2):
        super(ResGCN_Improved, self).__init__()
        ch_in = in_dim
        # 노트북 구조: 각 블록의 입력 차원을 동적으로 처리
        self.blocks = nn.ModuleList([
            ResBlock(ch_in if i == 0 else hidden, hidden) 
            for i in range(num_blocks)
        ])
        self.head = nn.Linear(hidden, num_classes)  # -> head.weight/head.bias
        
    def forward(self, data):
        """
        Args:
            data: PyTorch Geometric Batch 객체
                - x: [TotalNodes, in_dim] 임베딩 벡터
                - edge_index: [2, num_edges] 엣지 인덱스
                - batch: [TotalNodes] 배치 인덱스 (각 노드가 어느 그래프에 속하는지)
        
        Returns:
            logits: [BatchSize, num_classes] 예측 로짓
        """
        x, edge_index = data.x, data.edge_index
        
        # Residual GCN blocks
        for blk in self.blocks:
            x = blk(x, edge_index)
        
        # 노트북 구조: batch가 있으면 평균 풀링, 없으면 전체 평균
        logits = self.head(x)  # [total_nodes, C]
        # 각 샘플=그래프 1개, 여기서는 1노드 그래프이므로 평균 풀링해도 동일
        if hasattr(data, "batch"):
            b = data.batch
            num_g = int(b.max().item()) + 1
            out = torch.zeros(num_g, logits.size(-1), device=logits.device)
            out = out.index_add(0, b, logits)
            cnt = torch.bincount(b, minlength=num_g).clamp_min(1).unsqueeze(1)
            return out / cnt
        return logits.mean(dim=0, keepdim=True)

