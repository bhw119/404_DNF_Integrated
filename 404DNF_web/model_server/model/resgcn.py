"""
ResGCN_Improved 모델 정의
PyTorch Geometric 기반의 Graph Convolutional Network 모델
노트북(ResGCN_try.ipynb) 구조와 완전히 일치
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GCNConv
from torch_geometric.nn.norm import BatchNorm


class ResidualGCNBlock(nn.Module):
    """Residual Block for GCN - 노트북 구조와 완전히 동일"""
    def __init__(self, dim_in, dim_out, dropout=0.1):
        super().__init__()
        self.conv = GCNConv(dim_in, dim_out, improved=True)  # 노트북: improved=True
        self.bn = BatchNorm(dim_out)
        self.dropout = dropout
        self.res_proj = nn.Linear(dim_in, dim_out) if dim_in != dim_out else None
        
    def forward(self, x, edge_index, edge_weight=None):
        """
        Args:
            x: [N, dim_in] 노드 임베딩
            edge_index: [2, E] 엣지 인덱스
            edge_weight: [E] 엣지 가중치 (None 가능, 노트북에서는 사용 안 함)
        """
        identity = x
        # 노트북: edge_weight=None이면 내부 기본 정규화
        out = self.conv(x, edge_index, edge_weight=edge_weight)
        out = self.bn(out)
        out = F.relu(out, inplace=True)
        out = F.dropout(out, p=self.dropout, training=self.training)
        if self.res_proj is not None:
            identity = self.res_proj(identity)
        return out + identity


class ResGCN(nn.Module):
    """ResGCN 모델 - 노트북 구조와 완전히 동일"""
    def __init__(self, in_dim, hidden, out_dim, layers=2, dropout=0.1):
        super().__init__()
        dims = [in_dim] + [hidden] * layers
        self.blocks = nn.ModuleList([
            ResidualGCNBlock(dims[i], dims[i+1], dropout=dropout) 
            for i in range(layers)
        ])
        self.head = nn.Linear(hidden, out_dim)
        
    def forward(self, data):
        """
        Args:
            data: PyTorch Geometric Data 또는 Batch 객체
                - x: [TotalNodes, in_dim] 임베딩 벡터
                - edge_index: [2, num_edges] 엣지 인덱스
                - edge_weight: [num_edges] 엣지 가중치 (optional, 노트북에서는 None)
        
        Returns:
            logits: [TotalNodes, out_dim] 예측 로짓 (노트북: 전체 노드에 대해 반환)
        """
        x, edge_index = data.x, data.edge_index
        edge_weight = getattr(data, "edge_weight", None)  # 노트북: edge_weight=None
        
        # Residual GCN blocks
        for blk in self.blocks:
            x = blk(x, edge_index, edge_weight=edge_weight)
        
        # 노트북: head(x)만 반환 (평균 풀링 없음)
        return self.head(x)


# 호환성을 위한 별칭
ResGCN_Improved = ResGCN

